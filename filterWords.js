const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Default input and output file paths
const defaultInputFile = 'dictionary.txt';
const defaultOutputFile = 'filtered_dictionary.txt';

// Get command line arguments
const inputFile = process.argv[2] || defaultInputFile;
const outputFile = process.argv[3] || defaultOutputFile;

// Create readable and writable streams
const readStream = fs.createReadStream(inputFile, { encoding: 'utf8' });
const writeStream = fs.createWriteStream(outputFile, { encoding: 'utf8' });

// Create interface for reading line by line
const rl = readline.createInterface({
  input: readStream,
  crlfDelay: Infinity
});

// Counter for statistics
let totalLines = 0;
let filteredLines = 0;

console.log(`Processing file: ${inputFile}`);
console.log(`Output will be saved to: ${outputFile}`);

// Process each line
rl.on('line', (line) => {
  totalLines++;
  
  // Trim whitespace from the line
  const trimmedLine = line.trim();
  
  // Check if line length is between 2 and 5 characters (inclusive)
  if (trimmedLine.length >= 2 && trimmedLine.length <= 5) {
    writeStream.write(trimmedLine + '\n');
    filteredLines++;
  }
});

// Handle completion
rl.on('close', () => {
  console.log(`Processing complete!`);
  console.log(`Total lines processed: ${totalLines}`);
  console.log(`Lines kept (2-5 characters): ${filteredLines}`);
  console.log(`Lines removed: ${totalLines - filteredLines}`);
  
  writeStream.end();
});

// Handle errors
readStream.on('error', (err) => {
  console.error(`Error reading file: ${err.message}`);
  process.exit(1);
});

writeStream.on('error', (err) => {
  console.error(`Error writing to file: ${err.message}`);
  process.exit(1);
});

writeStream.on('finish', () => {
  console.log(`Successfully wrote filtered content to ${outputFile}`);
}); 