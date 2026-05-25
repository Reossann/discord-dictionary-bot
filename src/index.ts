// src/index.ts
import {
  Client,
  Colors,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Interaction,
  InteractionReplyOptions, // 👈 追加
  MessageFlags,
} from "discord.js";
import dotenv from "dotenv";
import { prisma } from "./prismaClient";
import { findDuplicateWithinInput } from "./utils/contextScoring";
import {
  hasDisallowedMention,
  MENTION_BLOCK_MESSAGE,
} from "./utils/mentionGuard";

import * as commands from "./commands";
import { normalizeTitleForComparison } from "./commands/add";
import { handleMessage } from "./events/messageHandler";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`準備OK！ ${c.user.tag} が起動しました。`);
  console.log(
    `コマンド同期完了: /add, /add-calender, /update-calender, /calender-list, /delete-calender, /add-wiki, /quiz, /quiz_battle, /wiki-quiz, /escape, /list, /delete, /update, /search, /introduction, /request, context-delete が使えます`,
  );
});

const commandMap: { [key: string]: (interaction: any) => Promise<void> } = {
  add: commands.addCommand,
  "add-calender": commands.addCalenderCommand,
  "update-calender": commands.updateCalenderCommand,
  "add-wiki": commands.addWikiCommand,
  "calender-list": commands.calenderListCommand,
  "delete-calender": commands.deleteCalenderCommand,
  escape: commands.escapeCommand,
  list: commands.listCommand,
  delete: commands.deleteCommand,
  update: commands.updateCommand,
  search: commands.searchCommand,
  quiz: commands.quizCommand,
  quiz_battle: commands.quizBattleCommand,
  "wiki-quiz": commands.wikiQuizCommand,
  introduction: commands.introductionCommand,
  request: commands.requestCommand,
};

client.on(Events.MessageCreate, async (message) => {
  await handleMessage(message);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (interaction.isButton()) {
    if (
      interaction.customId.startsWith("adddup_confirm_") ||
      interaction.customId.startsWith("adddup_cancel_")
    ) {
      try {
        await commands.handleDuplicateRegistrationButton(interaction);
      } catch (error) {
        console.error("Add Duplicate Button Error", error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "❌ 確認処理中にエラーが発生しました。",
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      return;
    }

    if (
      interaction.customId.startsWith("dict_word_") ||
      interaction.customId.startsWith("dict_wiki_")
    ) {
      try {
        const [, kind, idText] = interaction.customId.split("_");
        const entityId = Number(idText);

        if (!Number.isInteger(entityId)) {
          await interaction.reply({
            content: "❌ 無効なボタンです。",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (kind === "word") {
          const guildId = interaction.guildId || "global";
          const word = await prisma.word.findFirst({
            where: {
              id: entityId,
              guildId,
            },
            include: { titles: true },
          });

          if (!word) {
            await interaction.reply({
              content: "❌ 解説データが見つかりませんでした。",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const titleText =
            word.titles.map((t) => t.text).join(" / ") || "詳細";
          const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle(`📚 解説: ${titleText}`)
            .setDescription(word.meaning)
            .setFooter({ text: "この表示はあなたにだけ見えています" });

          if (word.imageUrl) embed.setImage(word.imageUrl);
          if (word.link) embed.setURL(word.link);
          if (word.tag) {
            embed.addFields({ name: "🏷️ タグ", value: word.tag, inline: true });
          }

          await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (kind === "wiki") {
          const wikiWord = await prisma.wikiWord.findUnique({
            where: { id: entityId },
          });

          if (!wikiWord) {
            await interaction.reply({
              content: "❌ Wiki解説データが見つかりませんでした。",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle(`📚 説明: ${wikiWord.term}`)
            .setDescription(wikiWord.meaning)
            .setFooter({ text: "📚 Wikipediaより引用 (自動補完)" })
            .setURL(wikiWord.link);

          await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      } catch (error) {
        console.error("Guide Button Error", error);
        await interaction.reply({
          content: "❌ 解説の表示中にエラーが発生しました。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  }

  // 🅰️ スラッシュコマンド
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    const command = commandMap[commandName];

    if (command) {
      try {
        await command(interaction);
      } catch (error) {
        console.error(`Command Error: ${commandName}`, error);

        // 👇 ここを修正！型を明示します
        const reply: InteractionReplyOptions = {
          content: "❌ エラーが発生しました",
          flags: MessageFlags.Ephemeral,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      }
    } else {
      console.error(`コマンド ${commandName} は見つかりませんでした。`);
    }
  }

  // 🅱️ 右クリックメニュー
  else if (interaction.isMessageContextMenuCommand()) {
    if (
      interaction.commandName === "📖 辞書に登録" ||
      interaction.commandName === "📖 意味を引用して登録" ||
      interaction.commandName === "🔖 単語名を引用して登録"
    ) {
      try {
        await commands.contextAddCommand(interaction);
      } catch (error) {
        console.error(`Context Menu Error`, error);

        // 👇 ここも修正！型を明示します
        const reply: InteractionReplyOptions = {
          content: "❌ エラーが発生しました",
          flags: MessageFlags.Ephemeral,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      }
    } else if (interaction.commandName === "context-delete") {
      try {
        await commands.contextDeleteCommand(interaction);
      } catch (error) {
        console.error(`Context Delete Menu Error`, error);

        const reply: InteractionReplyOptions = {
          content: "❌ エラーが発生しました",
          flags: MessageFlags.Ephemeral,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      }
    }
  } else if (interaction.isModalSubmit()) {
    if (interaction.customId === "addWordModal_Context") {
      try {
        // フォームに入力された値を受け取る
        const inputWord = interaction.fields.getTextInputValue("wordInput");
        const inputMeaning =
          interaction.fields.getTextInputValue("meaningInput");

        if (hasDisallowedMention(inputMeaning)) {
          await interaction.reply({
            content: MENTION_BLOCK_MESSAGE,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // 🌟 ここが最重要！今いるサーバーの名札をつける
        const guildId = interaction.guildId || "global";

        // 「りんご/Apple」のようにスラッシュ区切りに対応
        const titles = inputWord
          .split("/")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

        const duplicateTitle = findDuplicateWithinInput(titles);

        if (duplicateTitle) {
          await interaction.reply({
            content: `❌ **「${duplicateTitle}」** がこの入力内で重複しています。`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // DB内に同じ単語が存在するか確認
        const existingTitles = await prisma.title.findMany({
          where: {
            word: { guildId: guildId },
          },
        });

        // 正規化した入力タイトルで検索
        const normalizedInputTitles = new Set(
          titles.map(normalizeTitleForComparison),
        );

        const duplicateMatches = existingTitles.filter((title) => {
          const normalizedDbTitle = normalizeTitleForComparison(title.text);
          return normalizedInputTitles.has(normalizedDbTitle);
        });

        if (duplicateMatches.length > 0) {
          const duplicateTexts = duplicateMatches
            .map((t) => t.text)
            .join(" / ");
          await interaction.reply({
            content: `❌ **「${duplicateTexts}」** はすでに登録されています。`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const contextInput =
          interaction.fields.getTextInputValue("contextInput") || null;
        const keywordsInput =
          interaction.fields.getTextInputValue("keywordsInput") || null;

        // データベースに保存！
        await prisma.word.create({
          data: {
            guildId: guildId, // 👈 サーバー名札！
            meaning: inputMeaning,
            contextLabel: contextInput,
            contextKeywords: keywordsInput,
            authorName: interaction.user.username,
            titles: {
              create: titles.map((t) => ({ text: t })),
            },
          },
        });

        const joinedTitle = titles.join(" / ");
        await interaction.reply({
          content: `✅ 右クリックから **「${joinedTitle}」** を登録しました！`,
        });
      } catch (error) {
        console.error(`Modal Submit Error`, error);
        await interaction.reply({
          content: "❌ 登録中にエラーが発生しました",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

//自動で入力してほしい

//supabaseに移す
