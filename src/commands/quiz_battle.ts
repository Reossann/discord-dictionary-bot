import {
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  Message,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { prisma } from "../prismaClient";
import {
  endQuizBattleSession,
  startQuizBattleSession,
} from "../utils/quizBattleState";
import {
  isQuizGuildActive,
  markQuizGuildActive,
  unmarkQuizGuildActive,
} from "../utils/quizState";

const QUIZ_RECENT_LIMIT = 10;
const BATTLE_RECEPTION_MS = 60 * 1000;
const recentBattleWordIdsByGuild = new Map<string, number[]>();

function normalizeForQuizMatch(str: string): string {
  return str
    .replace(/[\u3041-\u3096]/g, (match) =>
      String.fromCharCode(match.charCodeAt(0) + 0x60),
    )
    .toLowerCase()
    .trim();
}

function getDisplayTitle(word: { titles: Array<{ text: string }> }): string {
  return word.titles.map((title) => title.text).join(" / ");
}

function getScoreBoard(scores: Map<string, number>): string {
  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return "まだスコアはありません。";
  }

  return sorted
    .map(([userId, score], index) => `${index + 1}. <@${userId}>: ${score}点`)
    .join("\n");
}

async function pickBattleWord(guildId: string) {
  const allWords = await prisma.word.findMany({
    where: { guildId },
    include: { titles: true },
  });

  if (allWords.length === 0) return null;

  const recentIds = recentBattleWordIdsByGuild.get(guildId) || [];
  const recentIdSet = new Set(recentIds);
  const candidateWords = allWords.filter((word) => !recentIdSet.has(word.id));
  const sourceWords = candidateWords.length > 0 ? candidateWords : allWords;
  const randomIndex = Math.floor(Math.random() * sourceWords.length);
  const word = sourceWords[randomIndex] || null;

  if (word) {
    const updatedRecentIds = [...recentIds, word.id].slice(-QUIZ_RECENT_LIMIT);
    recentBattleWordIdsByGuild.set(guildId, updatedRecentIds);
  }

  return word;
}

export const data = new SlashCommandBuilder()
  .setName("quiz_battle")
  .setDescription("参加者を集めて連戦形式のクイズバトルを行います")
  .addIntegerOption((option) =>
    option
      .setName("goal_line")
      .setDescription("何問正解したら終了するか")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addIntegerOption((option) =>
    option
      .setName("answer_window")
      .setDescription("1問あたり何秒回答を受け付けるか")
      .setRequired(true)
      .setMinValue(5)
      .setMaxValue(300),
  );

export const quizBattleCommand = async (
  interaction: ChatInputCommandInteraction,
) => {
  const guildId = interaction.guildId || "global";

  if (isQuizGuildActive(guildId)) {
    await interaction.reply({
      content:
        "⏳ このサーバーでは現在クイズ進行中です。終了まで待ってください。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  markQuizGuildActive(guildId);

  let lockReleased = false;
  const releaseLock = () => {
    if (lockReleased) return;
    unmarkQuizGuildActive(guildId);
    lockReleased = true;
  };

  try {
    const goalLine = interaction.options.getInteger("goal_line", true);
    const answerWindowSeconds = interaction.options.getInteger(
      "answer_window",
      true,
    );

    await interaction.reply({
      content: `🏁 クイズバトルの受け付けが始まりました！ このメッセージにリアクションした人が参加者です。\n受付時間は1分です。\n途中で終わりたい場合は /break と打ってください。\n\n（ルール）\nゴールライン：${goalLine}問\n回答時間：${answerWindowSeconds}秒`,
    });

    const acceptanceMessage = await interaction.fetchReply();
    const channel = acceptanceMessage.channel;

    if (!channel || !channel.isTextBased()) {
      await interaction.editReply(
        "❌ このチャンネルではクイズバトルを実行できません。",
      );
      releaseLock();
      return;
    }

    if (!("createMessageCollector" in channel)) {
      await interaction.editReply(
        "❌ このチャンネルではクイズバトルを実行できません。",
      );
      releaseLock();
      return;
    }

    const session = {
      guildId,
      channelId: channel.id,
      participants: new Set<string>(),
      scores: new Map<string, number>(),
      goalLine,
      answerWindowSeconds,
      cancelRequested: false,
    };

    startQuizBattleSession(session);

    await acceptanceMessage.react("✅").catch(() => undefined);
    const reactionCollector = acceptanceMessage.createReactionCollector({
      time: BATTLE_RECEPTION_MS,
    });

    const acceptanceCancelWatcher = setInterval(() => {
      if (!session.cancelRequested) return;
      reactionCollector.stop("cancelled");
    }, 500);

    reactionCollector.on("collect", async (_reaction, user) => {
      if (user.bot) return;
      session.participants.add(user.id);
    });

    await new Promise<void>((resolve) => {
      reactionCollector.on("end", () => resolve());
    });

    clearInterval(acceptanceCancelWatcher);

    if (session.cancelRequested) {
      await channel.send("🛑 クイズバトルは /break により中断されました。");
      endQuizBattleSession(channel.id);
      releaseLock();
      return;
    }

    session.participants.delete(interaction.client.user?.id || "");

    if (session.participants.size === 0) {
      await channel.send("❌ 参加者がいなかったのでクイズバトルを終了します。");
      endQuizBattleSession(channel.id);
      releaseLock();
      return;
    }

    session.participants.forEach((userId) => session.scores.set(userId, 0));

    await channel.send(
      `🎮 **クイズバトル開始！** 参加者: ${session.participants.size}人 / ゴールライン: ${goalLine}問 / 回答猶予: ${answerWindowSeconds}秒`,
    );

    let battleFinished = false;
    let round = 0;

    while (!battleFinished) {
      round += 1;
      const word = await pickBattleWord(guildId);

      if (!word) {
        await channel.send(
          "❌ まだ単語が登録されていません。クイズバトルを終了します。",
        );
        break;
      }

      if (session.cancelRequested) {
        await channel.send("🛑 クイズバトルは /break により中断されました。");
        break;
      }

      const titleText = getDisplayTitle(word);
      const normalizedTitles = new Set(
        word.titles.map((title) => normalizeForQuizMatch(title.text)),
      );

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(`🧠 第${round}問`)
        .setDescription(`**意味:**\n${word.meaning}`)
        .setFooter({
          text: `${answerWindowSeconds}秒以内に参加者だけが回答できます`,
        });

      if (word.imageUrl) embed.setImage(word.imageUrl);

      await channel.send({ embeds: [embed] });

      const questionCollector = channel.createMessageCollector({
        filter: (message: Message) =>
          !message.author.bot && session.participants.has(message.author.id),
        time: answerWindowSeconds * 1000,
      });

      const battleCancelWatcher = setInterval(() => {
        if (!session.cancelRequested) return;
        questionCollector.stop("cancelled");
      }, 500);

      let answered = false;
      const roundResult = await new Promise<"answered" | "timeout">(
        (resolve) => {
          questionCollector.on("collect", async (message: Message) => {
            if (answered) return;

            const normalizedAnswer = normalizeForQuizMatch(message.content);
            const isCorrect = normalizedTitles.has(normalizedAnswer);

            if (!isCorrect) {
              await message.react("❌").catch(() => undefined);
              return;
            }

            answered = true;
            const currentScore =
              (session.scores.get(message.author.id) || 0) + 1;
            session.scores.set(message.author.id, currentScore);

            await message.react("⭕").catch(() => undefined);
            await message
              .reply(
                `🎉 **正解！** ${message.author} が 1ポイント獲得しました。\n現在スコア: ${currentScore} / ${goalLine}`,
              )
              .catch(() => undefined);

            questionCollector.stop("answered");
            resolve("answered");
          });

          questionCollector.on("end", () => {
            if (!answered) {
              resolve("timeout");
            }
          });
        },
      );

      clearInterval(battleCancelWatcher);

      if (session.cancelRequested) {
        await channel.send("🛑 クイズバトルは /break により中断されました。");
        break;
      }

      if (roundResult === "timeout") {
        await channel.send(
          `⏰ 時間切れ！ 正解は **「${titleText}」** でした。`,
        );
      }

      const winner = Array.from(session.scores.entries()).find(
        (entry) => entry[1] >= goalLine,
      );

      if (winner) {
        battleFinished = true;
        const [winnerId, winnerScore] = winner;
        await channel.send(
          `🏆 **クイズバトル終了！** 勝者は <@${winnerId}> です。\n最終スコア: ${winnerScore}点\n\n**最終順位**\n${getScoreBoard(session.scores)}`,
        );
      }
    }

    endQuizBattleSession(channel.id);
    releaseLock();
  } catch (error) {
    console.error(error);
    if (interaction.channelId) {
      endQuizBattleSession(interaction.channelId);
    }
    releaseLock();

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "❌ エラーが発生しました。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: "❌ エラーが発生しました。",
      flags: MessageFlags.Ephemeral,
    });
  }
};
