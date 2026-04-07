export const getDashboardPrefill = (urlString, defaultJoinName) => {
  const url = new URL(urlString, 'http://localhost');
  const meetingUrl = (url.searchParams.get('meetingUrl') || '').trim();
  const requestedJoinName = (url.searchParams.get('requestedJoinName') || '').trim();

  return {
    meetingUrl,
    requestedJoinName: requestedJoinName || defaultJoinName,
    shouldAutoQueue: meetingUrl.length > 0
  };
};
