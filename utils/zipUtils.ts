import { ProjectFile } from '../types';

// We need to declare JSZip as it's loaded via CDN in index.html
declare var JSZip: any;

const RELEVANT_EXTENSIONS = [
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', 
  '.html', '.css', '.py', '.java', '.c', '.cpp', '.h'
];

const MAX_FILES = 50;
const MAX_TOTAL_SIZE = 500 * 1024; // 500KB text limit for context safety

export const extractTextFromZip = async (file: File): Promise<ProjectFile[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const zip = new JSZip();
        const contents = await zip.loadAsync(e.target?.result);
        const files: ProjectFile[] = [];
        let totalSize = 0;

        const entries = Object.keys(contents.files);
        
        // Prioritize root files or specific informative files
        const sortedEntries = entries.sort((a, b) => {
          const aScore = a.toLowerCase().includes('readme') ? -1 : 1;
          const bScore = b.toLowerCase().includes('readme') ? -1 : 1;
          return aScore - bScore;
        });

        for (const filename of sortedEntries) {
          if (files.length >= MAX_FILES) break;
          if (totalSize >= MAX_TOTAL_SIZE) break;

          const fileEntry = contents.files[filename];
          if (fileEntry.dir) continue;

          // Check extension
          const isRelevant = RELEVANT_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
          if (!isRelevant) continue;

          const textContent = await fileEntry.async('string');
          
          // Basic binary check (skip if lots of null bytes)
          if (textContent.includes('\0')) continue;

          files.push({
            name: filename,
            content: textContent
          });

          totalSize += textContent.length;
        }
        
        resolve(files);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};