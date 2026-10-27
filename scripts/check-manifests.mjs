import fs from 'node:fs'

const file = 'package.json'
const bytes = fs.readFileSync(file)
if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
  console.error(`${file}: UTF-8 BOM is not allowed`)
  process.exit(1)
}
const pkg = JSON.parse(bytes.toString('utf8'))
const contract = pkg.dsh?.platform?.contract
if (typeof contract !== 'string' || !/^1\./.test(contract.trim())) {
  console.error(`${file}: dsh.platform.contract must be 1.x`)
  process.exit(1)
}
console.log(`${file}: ok (contract ${contract})`)
