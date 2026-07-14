// Small loaders shared across tools. Kept here so every tool reads the fact base
// and résumé the same way the core services do.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { latexToPlainText, type Facts } from '@resume/core';

export async function loadFacts(root: string): Promise<Facts> {
  return JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
}

export async function loadResumeText(root: string): Promise<string> {
  return latexToPlainText(await readFile(join(root, 'resume.tex'), 'utf8'));
}

// A short, model-friendly cap so tool results never blow the context budget.
export function cap<T>(arr: T[], n = 40): T[] {
  return arr.length > n ? arr.slice(0, n) : arr;
}
