export const getDashboardPrefill = (urlString, defaultJoinName) => {
  const url = new URL(urlString, 'http://localhost');
  const meetingUrl = (url.searchParams.get('meetingUrl') || '').trim();
  const requestedJoinName = (url.searchParams.get('requestedJoinName') || '').trim();
  const jobId = (url.searchParams.get('jobId') || '').trim();

  return {
    meetingUrl,
    jobId,
    requestedJoinName: requestedJoinName || defaultJoinName,
    shouldAutoQueue: meetingUrl.length > 0
  };
};
