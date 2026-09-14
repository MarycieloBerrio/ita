import { appendFile, stat } from 'node:fs/promises';

const NAME = /^ita-backup-\d{8}-\d+-\d+$/;
export const MAX_STORAGE_BYTES = 350_000_000;

export function retentionPlan(artifacts, incomingBytes, budgetBytes, outsideBytes = 0) {
  if (
    ![incomingBytes, budgetBytes, outsideBytes].every(Number.isSafeInteger) ||
    incomingBytes <= 0 ||
    budgetBytes <= 0 ||
    budgetBytes > MAX_STORAGE_BYTES ||
    outsideBytes < 0
  )
    throw new Error('INVALID_STORAGE_BUDGET');
  const live = artifacts.filter((a) => !a.expired);
  const backups = live
    .filter((a) => NAME.test(a.name))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  let total =
    live.reduce((sum, a) => sum + a.size_in_bytes, outsideBytes) + incomingBytes + 1_000_000;
  const remove = [],
    keep = [...backups];
  while ((keep.length >= 7 || total > budgetBytes) && keep.length > 1) {
    const old = keep.pop();
    remove.push(old);
    total -= old.size_in_bytes;
  }
  // Preserve the newest existing recovery point even if upload capacity is insufficient.
  if (total > budgetBytes) throw new Error('BACKUP_STORAGE_BUDGET_EXCEEDED');
  return { remove, projectedBytes: total, projectedCopies: keep.length + 1 };
}

async function github(path, method = 'GET') {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok) throw new Error('BACKUP_GITHUB_REQUEST_FAILED');
  return response.status === 204 ? null : response.json();
}

export async function prepareRetention(file) {
  if (
    ![process.env.ITA_BACKUP_BUDGET_BYTES, process.env.ITA_OTHER_ACTIONS_STORAGE_BYTES].every(
      (value) => typeof value === 'string' && /^\d+$/.test(value),
    )
  )
    throw new Error('MEASURED_STORAGE_BUDGET_REQUIRED');
  const all = [];
  for (let page = 1; ; page++) {
    const result = await github(`actions/artifacts?per_page=100&page=${page}`);
    all.push(...result.artifacts);
    if (result.artifacts.length < 100) break;
    if (page >= 100) throw new Error('TOO_MANY_ARTIFACTS_TO_VALIDATE_QUOTA');
  }
  const plan = retentionPlan(
    all,
    (await stat(file)).size,
    Number(process.env.ITA_BACKUP_BUDGET_BYTES),
    Number(process.env.ITA_OTHER_ACTIONS_STORAGE_BYTES),
  );
  for (const artifact of plan.remove) await github(`actions/artifacts/${artifact.id}`, 'DELETE');
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Respaldo cifrado: almacenamiento proyectado ${plan.projectedBytes} bytes; ${plan.projectedCopies} copias. Cuota externa declarada, revisar mensualmente.\n`,
    );
}
