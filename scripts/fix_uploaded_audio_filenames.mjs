import { Client } from 'pg';

const scorePotentialFileNameDecoding = (value) => {
  const replacementCount = (value.match(/\uFFFD/g) || []).length;
  const cjkCount = (value.match(/[\u3400-\u9FFF]/g) || []).length;
  const mojibakeCount = (value.match(/[ÃÂÐÑØæçéèêëîïôöûü]/g) || []).length;
  return cjkCount * 3 - replacementCount * 5 - mojibakeCount;
};

const normalizeUploadedFileName = (value) => {
  let bestCandidate = value;
  let bestScore = scorePotentialFileNameDecoding(value);
  let current = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const decoded = Buffer.from(current, 'latin1').toString('utf8');
    const decodedScore = scorePotentialFileNameDecoding(decoded);

    if (decodedScore > bestScore) {
      bestCandidate = decoded;
      bestScore = decodedScore;
    }

    current = decoded;
  }

  return bestCandidate;
};

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5432/ainotetacker';

const client = new Client({ connectionString });

await client.connect();

const result = await client.query(
  `
    SELECT id, uploaded_file_name, meeting_url
    FROM recording_jobs
    WHERE input_source = 'uploaded-audio'
      AND uploaded_file_name IS NOT NULL
    ORDER BY created_at DESC
  `
);

let updated = 0;

for (const row of result.rows) {
  const normalizedName = normalizeUploadedFileName(row.uploaded_file_name);

  if (normalizedName === row.uploaded_file_name) {
    continue;
  }

  const updatedMeetingUrl = row.meeting_url?.startsWith('uploaded://')
    ? `uploaded://${encodeURIComponent(normalizedName)}`
    : row.meeting_url;

  await client.query(
    `
      UPDATE recording_jobs
      SET uploaded_file_name = $2,
          meeting_url = $3,
          updated_at = now()
      WHERE id = $1
    `,
    [row.id, normalizedName, updatedMeetingUrl]
  );

  updated += 1;
  console.log(`${row.id}\t${row.uploaded_file_name} -> ${normalizedName}`);
}

console.log(`updated_rows=${updated}`);

await client.end();
