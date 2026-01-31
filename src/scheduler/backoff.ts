export const getSchedulerBackoffMinutes = (failCount: number): number => {
  const safeFailCount = Math.max(1, Math.floor(failCount));
  const minutes = Math.pow(2, safeFailCount);
  return Math.min(Math.max(minutes, 10), 60);
};
