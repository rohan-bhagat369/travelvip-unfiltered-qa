import fs from 'fs';
import path from 'path';

const SESSION_FILE = path.resolve('reports/flight/.session.json');

export default async function globalSetup() {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}
