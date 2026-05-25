export interface QuizBattleSession {
  guildId: string;
  channelId: string;
  participants: Set<string>;
  scores: Map<string, number>;
  goalLine: number;
  answerWindowSeconds: number;
  cancelRequested: boolean;
}

const activeQuizBattlesByChannel = new Map<string, QuizBattleSession>();

export function startQuizBattleSession(session: QuizBattleSession): void {
  activeQuizBattlesByChannel.set(session.channelId, session);
}

export function endQuizBattleSession(channelId: string): void {
  activeQuizBattlesByChannel.delete(channelId);
}

export function requestQuizBattleCancel(channelId: string): boolean {
  const session = activeQuizBattlesByChannel.get(channelId);
  if (!session) return false;

  session.cancelRequested = true;
  return true;
}

export function isQuizBattleCancelRequested(channelId: string): boolean {
  return activeQuizBattlesByChannel.get(channelId)?.cancelRequested ?? false;
}

export function isQuizBattleChannelActive(channelId: string): boolean {
  return activeQuizBattlesByChannel.has(channelId);
}

export function getQuizBattleSession(
  channelId: string,
): QuizBattleSession | undefined {
  return activeQuizBattlesByChannel.get(channelId);
}
