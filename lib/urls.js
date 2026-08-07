/**
 * Reading and normalising the URL input list.
 *
 * Accepted sources (merged in this order):
 *   1. URLs passed directly as CLI arguments
 *   2. A plain text file (default: urls.txt)
 *   3. stdin, when it is piped
 */

import { readFile } from 'node:fs/promises';

import { UserError } from './errors.js';

/** Parse a single input line into `{ url, label }` or `null` for comments/blanks. */
export function parseLine(rawLine) {
  const line = rawLine.replace(/^﻿/, '').trim();
  if (!line) return null;
  // Only whole-line comments — a trailing "#" is a legal URL fragment.
  if (line.startsWith('#') || line.startsWith('//')) return null;

  // Optional human readable label: "https://example.com | Startseite"
  const separator = line.indexOf('|');
  const rawUrl = separator === -1 ? line : line.slice(0, separator).trim();
  const label = separator === -1 ? '' : line.slice(separator + 1).trim();
  if (!rawUrl) return null;

  return { url: rawUrl, label };
}

/** Add a scheme when the user wrote a bare host, then validate it. */
export function normaliseUrl(rawUrl) {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new UserError(`Ungültige URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UserError(`Nicht unterstütztes Protokoll "${parsed.protocol}" in "${rawUrl}" (nur http/https).`);
  }
  return parsed.href;
}

/** Turn raw text (file or stdin contents) into `{ url, label }` entries. */
export function parseUrlList(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const parsed = parseLine(rawLine);
    if (!parsed) continue;
    try {
      entries.push({ url: normaliseUrl(parsed.url), label: parsed.label });
    } catch (error) {
      throw new UserError(`${error.message} (Zeile ${index + 1})`);
    }
  }
  return entries;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Collect the final, de-duplicated list of targets.
 *
 * @returns {Promise<{ targets: Array<{url: string, label: string}>, duplicates: string[], source: string }>}
 */
export async function collectTargets({ inputFile, cliUrls = [], inputWasExplicit = false }) {
  const collected = [];
  const sources = [];

  if (cliUrls.length > 0) {
    for (const raw of cliUrls) {
      const parsed = parseLine(raw) ?? { url: raw, label: '' };
      collected.push({ url: normaliseUrl(parsed.url), label: parsed.label });
    }
    sources.push('CLI-Argumente');
  }

  // URLs auf der Kommandozeile haben Vorrang: die Standarddatei wird dann nicht
  // zusätzlich gelesen. Ein ausdrückliches --input kombiniert dagegen bewusst.
  const useInputFile = Boolean(inputFile) && (inputWasExplicit || cliUrls.length === 0);

  if (useInputFile) {
    let text = null;
    try {
      text = await readFile(inputFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A missing default file is only an error when nothing else was supplied.
      if (inputWasExplicit) {
        throw new UserError(`Eingabedatei nicht gefunden: ${inputFile}`);
      }
    }
    if (text !== null) {
      collected.push(...parseUrlList(text));
      sources.push(inputFile);
    }
  }

  if (collected.length === 0 && !process.stdin.isTTY) {
    const piped = await readStdin();
    if (piped.trim()) {
      collected.push(...parseUrlList(piped));
      sources.push('stdin');
    }
  }

  const seen = new Map();
  const duplicates = [];
  for (const entry of collected) {
    if (seen.has(entry.url)) {
      duplicates.push(entry.url);
      // A later, richer label still wins so a labelled duplicate is not lost.
      if (entry.label && !seen.get(entry.url).label) seen.get(entry.url).label = entry.label;
      continue;
    }
    seen.set(entry.url, { ...entry });
  }

  return {
    targets: [...seen.values()],
    duplicates,
    source: sources.join(' + ') || 'keine',
  };
}
