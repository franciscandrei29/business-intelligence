import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ANNOTATIONS_FILE = path.join(process.cwd(), 'data', 'annotations.json');

export type AnnotationCategory = 'campaign' | 'promotion' | 'product_launch' | 'issue' | 'other';

export interface Annotation {
  id: string;
  storeId: string;
  userId: string;
  date: string;
  text: string;
  category: AnnotationCategory;
  createdAt: string;
}

function readAnnotations(): Annotation[] {
  try {
    const dir = path.dirname(ANNOTATIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(ANNOTATIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ANNOTATIONS_FILE, 'utf8'));
  } catch { return []; }
}

function writeAnnotations(annotations: Annotation[]) {
  const dir = path.dirname(ANNOTATIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ANNOTATIONS_FILE, JSON.stringify(annotations, null, 2));
}

export function addAnnotation(
  userId: string,
  storeId: string,
  date: string,
  text: string,
  category: AnnotationCategory
): Annotation {
  const annotations = readAnnotations();
  const annotation: Annotation = {
    id: crypto.randomBytes(12).toString('hex'),
    storeId,
    userId,
    date,
    text,
    category,
    createdAt: new Date().toISOString(),
  };
  annotations.push(annotation);
  writeAnnotations(annotations);
  return annotation;
}

export function getAnnotations(storeId: string, startDate?: string, endDate?: string): Annotation[] {
  let annotations = readAnnotations().filter(a => a.storeId === storeId);
  if (startDate) annotations = annotations.filter(a => a.date >= startDate);
  if (endDate) annotations = annotations.filter(a => a.date <= endDate);
  return annotations.sort((a, b) => b.date.localeCompare(a.date));
}

export function deleteAnnotation(userId: string, annotationId: string): boolean {
  const annotations = readAnnotations();
  const idx = annotations.findIndex(a => a.userId === userId && a.id === annotationId);
  if (idx === -1) return false;
  annotations.splice(idx, 1);
  writeAnnotations(annotations);
  return true;
}
