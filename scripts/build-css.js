#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tailwindPostcss = require('@tailwindcss/postcss');
const autoprefixer = require('autoprefixer');

const inPath = path.join(__dirname, '..', 'shared', 'style.css');
const outPath = path.join(__dirname, '..', 'shared', 'style.generated.css');

async function build() {
  try {
    const input = fs.readFileSync(inPath, 'utf8');
    const result = await postcss([tailwindPostcss({ config: './tailwind.config.js' }), autoprefixer]).process(input, { from: inPath, to: outPath });
    fs.writeFileSync(outPath, result.css);
    if (result.map) fs.writeFileSync(outPath + '.map', result.map);
    console.log('Built CSS ->', outPath);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

build();
