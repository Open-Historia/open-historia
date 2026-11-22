// Presentation-only grouping for the AI debug console. Provider records,
// usage, retries and raw export stay individual and lossless.
import { requestCount } from "./telemetry.js";

export const groupGenerationRows = (records) => {
  const result = [];
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const id = typeof record.groupTurnId === "string" ? record.groupTurnId : "";
    if (!id) {
      result.push({ kind: "record", key: record.id, record });
      continue;
    }
    let row = groups.get(id);
    if (!row) {
      row = { kind: "group", key: id, name: record.groupName || "Group chat",
        records: [], totalSpeakers: 0, speakers: new Set(),
        requests: 0, promptTokens: 0, outputTokens: 0,
        completedSpeakers: 0, failedBatches: 0, pendingBatches: 0 };
      groups.set(id, row);
      result.push(row);
    }
    row.records.push(record);
    row.totalSpeakers = Math.max(row.totalSpeakers, Number(record.groupTotalSpeakers) || 0);
    for (const speakerId of Array.isArray(record.groupSpeakerIds) ? record.groupSpeakerIds : []) {
      row.speakers.add(speakerId);
    }
    row.requests += requestCount(record) || 0;
    row.promptTokens += record.usage?.promptTokens || 0;
    row.outputTokens += record.usage?.outputTokens || 0;
    if (record.ok === false) row.failedBatches += 1;
    else if (record.ok === true) row.completedSpeakers += (record.groupSpeakerIds?.length || 1);
    else row.pendingBatches += 1;
  }
  return result.map((row) => row.kind === "group"
    ? { ...row, speakers: [...row.speakers], totalSpeakers: Math.max(row.totalSpeakers, row.speakers.size) }
    : row);
};
