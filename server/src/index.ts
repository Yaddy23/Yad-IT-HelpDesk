import 'dotenv/config';

import express from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 5000);

app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', service: 'itsm-api', version: 'v1', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[server] ITSM API listening on http://localhost:${PORT}`);
});

export default app;
