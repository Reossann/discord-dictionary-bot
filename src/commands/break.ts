import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import {
  getQuizBattleSession,
  requestQuizBattleCancel,
} from "../utils/quizBattleState";

export const data = new SlashCommandBuilder()
  .setName("break")
  .setDescription("進行中のクイズバトルを中断します");

export const breakCommand = async (
  interaction: ChatInputCommandInteraction,
) => {
  if (!interaction.channelId) {
    await interaction.reply({
      content: "❌ チャンネル情報を取得できません。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = getQuizBattleSession(interaction.channelId);
  if (!session) {
    await interaction.reply({
      content: "❌ このチャンネルで進行中のクイズバトルはありません。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const accepted = requestQuizBattleCancel(interaction.channelId);
  if (!accepted) {
    await interaction.reply({
      content: "❌ クイズバトルの中断に失敗しました。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: "🛑 クイズバトルの中断を受け付けました。",
    flags: MessageFlags.Ephemeral,
  });
};
