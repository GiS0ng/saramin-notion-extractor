(function initializeSaraminWorkflow(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SaraminWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  class CancellationError extends Error {
    constructor(message = "사용자가 자동 수집을 중지했습니다.") {
      super(message);
      this.name = "CancellationError";
      this.cancelled = true;
    }
  }

  function httpError(status, message, retryAfterMs = 0) {
    const error = new Error(message);
    error.status = status;
    error.retryable = status === 429 || status >= 500;
    error.fatal = [401, 403, 404].includes(status);
    error.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
    return error;
  }

  function shouldRetry(error) {
    if (!error || error.cancelled || error.fatal) return false;
    if (typeof error.retryable === "boolean") return error.retryable;
    return /network|fetch|시간이 초과|Receiving end|message port|연결이? (?:끊|종료)|ERR_/i
      .test(String(error.message || ""));
  }

  function isFatal(error) {
    return Boolean(error?.fatal);
  }

  function publicError(error) {
    return {
      message: String(error?.message || "알 수 없는 오류").slice(0, 500),
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null
    };
  }

  function nextCursor(page, jobIndex, jobCount) {
    const pageFinished = jobIndex + 1 >= jobCount;
    return {
      currentPage: pageFinished ? page + 1 : page,
      nextJobIndex: pageFinished ? 0 : jobIndex + 1
    };
  }

  function jobDecision(recIdx, processedRecIdx, found, maxJobs) {
    if (found >= maxJobs) return "limit";
    if (processedRecIdx.has(recIdx)) return "duplicate";
    return "process";
  }

  return { CancellationError, httpError, shouldRetry, isFatal, publicError, nextCursor, jobDecision };
});
