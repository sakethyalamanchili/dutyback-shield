const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const artifactDir = 'C:\\Users\\yalam\\.gemini\\antigravity-ide\\brain\\7fa6d7b6-7d62-4bb9-ac19-11caa6055f6c';

function capture(url, outFile, width, height) {
  const tempOut = path.join('C:\\Users\\yalam\\AppData\\Local\\Temp', outFile);
  const finalOut = path.join(artifactDir, outFile);
  const cmd = `"${edgePath}" --headless --disable-gpu --virtual-time-budget=3000 --window-size=${width},${height} "--screenshot=${tempOut}" "${url}"`;
  console.log(`Capturing ${outFile}...`);
  execSync(cmd, { stdio: 'inherit' });
  if (fs.existsSync(tempOut)) {
    fs.copyFileSync(tempOut, finalOut);
    console.log(`Saved ${finalOut} (${fs.statSync(finalOut).size} bytes)`);
  } else {
    console.error(`Failed: ${tempOut} not found`);
  }
}

capture('http://127.0.0.1:4173/#tool_section', 'simplified_initial.png', 1280, 1100);
capture('http://127.0.0.1:4173/?demo=true', 'simplified_scrubbed.png', 1280, 2500);
console.log('Done!');
