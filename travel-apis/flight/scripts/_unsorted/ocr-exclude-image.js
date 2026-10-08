import { createWorker } from 'tesseract.js';
import fs from 'fs';

const img =
  'C:/Users/Rohan Bhagat/.cursor/projects/d-Travel-VIP-API-Automation/assets/c__Users_Rohan_Bhagat_AppData_Roaming_Cursor_User_workspaceStorage_ee277548aea8d113f503d112700c9ac1_images_image-fa9ca723-847e-4904-807c-8a51a1e2fe6d.png';

const worker = await createWorker('eng');
const {
  data: { text },
} = await worker.recognize(img);
await worker.terminate();
fs.writeFileSync('d:/Travel VIP API Automation/tmp/ocr-exclude-list.txt', text, 'utf8');
console.log(text);
