import { REST, Routes } from "discord.js";
import dotenv from "dotenv";

// 各コマンドの読み込み
import {
  data as addData,
  addFromMeaningData,
  addFromWordData,
} from "./commands/add";
import { data as addCalenderData } from "./commands/add_calender";
import { data as addWikiData } from "./commands/add_wiki";
import { data as breakData } from "./commands/break";
import { data as calenderListData } from "./commands/calender_list";
import { contextDeleteData } from "./commands/context_delete";
import { data as deleteData } from "./commands/delete";
import { data as deleteCalenderData } from "./commands/delete_calender";
import { data as escapeData } from "./commands/escape";
import { data as introData } from "./commands/introduction";
import { data as listData } from "./commands/list";
import { data as quizData } from "./commands/quiz";
import { data as quizBattleData } from "./commands/quiz_battle";
import { data as requestData } from "./commands/request";
import { data as searchData } from "./commands/search";
import { data as updateData } from "./commands/update";
import { data as updateCalenderData } from "./commands/update_calender";
import { data as wikiQuizData } from "./commands/wiki_quiz";

dotenv.config();

const commands = [
  updateData.toJSON(),
  listData.toJSON(),
  addData.toJSON(),
  addCalenderData.toJSON(),
  updateCalenderData.toJSON(),
  calenderListData.toJSON(),
  deleteCalenderData.toJSON(),
  addFromMeaningData.toJSON(),
  addFromWordData.toJSON(),
  contextDeleteData.toJSON(),
  addWikiData.toJSON(),
  quizData.toJSON(),
  quizBattleData.toJSON(),
  breakData.toJSON(),
  wikiQuizData.toJSON(),
  escapeData.toJSON(),
  deleteData.toJSON(),
  searchData.toJSON(),
  introData.toJSON(),
  requestData.toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    const clientId = process.env.APPLICATION_ID!;

    // 🔄 ここが改造ポイント！
    // 環境変数の文字列 (例: "123,456") をカンマで区切って配列 (例: ["123", "456"]) に変換します
    const guildIds = (process.env.GUILD_ID || "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id);

    if (guildIds.length === 0) {
      console.warn(
        "⚠️ GUILD_ID が設定されていません。コマンド登録をスキップします。",
      );
      return;
    }

    console.log(`📦 対象のサーバー: ${guildIds.length}個`);

    // 1. まずグローバルコマンドを消して綺麗にする (重複防止)
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log("🗑️  古いグローバルコマンドを削除しました");

    // 2. ループ処理で、指定された全サーバーにコマンドを登録！
    for (const guildId of guildIds) {
      try {
        console.log(`🚀 サーバー(ID: ${guildId}) に登録中...`);
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
          body: commands,
        });
        console.log(`✅ サーバー(ID: ${guildId}) への登録完了！`);
      } catch (error) {
        console.error(`❌ サーバー(ID: ${guildId}) への登録失敗:`, error);
      }
    }

    console.log("🎉 全ての対象サーバーへの登録処理が終わりました！");
  } catch (error) {
    console.error("❌ 全体エラー:", error);
  }
})();
