import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uuid = crypto.randomUUID();
const filePath = path.join(__dirname, 'data/test.txt')
fs.writeFileSync(filePath, uuid);
