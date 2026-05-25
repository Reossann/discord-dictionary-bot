export interface QuizBattleSession {
  guildId: string;
  channelId: string;
  participants: Set<string>;
  scores: Map<string, number>;
  goalLine: number;
  answerWindowSeconds: number;
}

const activeQuizBattlesByChannel = new Map<string, QuizBattleSession>();

export function startQuizBattleSession(session: QuizBattleSession): void {
  activeQuizBattlesByChannel.set(session.channelId, session);
}

export function endQuizBattleSession(channelId: string): void {
  activeQuizBattlesByChannel.delete(channelId);
}

export function isQuizBattleChannelActive(channelId: string): boolean {
  return activeQuizBattlesByChannel.has(channelId);
}

export function getQuizBattleSession(
  channelId: string,
): QuizBattleSession | undefined {
  return activeQuizBattlesByChannel.get(channelId);
}
