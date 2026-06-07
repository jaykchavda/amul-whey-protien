const { exec } = require('child_process');

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

console.log('==================================================');
console.log(`Amul Protein Scheduler Started: Running every 10 minutes`);
console.log('==================================================\n');

function runCheck() {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] Starting stock check...`);
  
  exec('node index.js', (error, stdout, stderr) => {
    if (error) {
      console.error(`[${time}] Execution error:`, error.message);
      return;
    }
    // Print the output of index.js
    console.log(stdout);
    if (stderr) {
      console.error(`[${time}] Stderr:`, stderr);
    }
  });
}

// Run the check immediately on startup
runCheck();

// Set interval to run the check every 10 minutes
setInterval(runCheck, INTERVAL_MS);
