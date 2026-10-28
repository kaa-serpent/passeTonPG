try {
  const response = await fetch('http://127.0.0.1:3000/api/health', {
    redirect: 'error', signal: AbortSignal.timeout(4000),
  });
  const body = await response.json();
  if (response.status !== 200 || body.status !== 'ok' || body.service !== 'passetonpg') process.exit(1);
} catch { process.exit(1); }
