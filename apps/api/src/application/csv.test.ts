import assert from "node:assert/strict";
import test from "node:test";
import { escapeCsvCell, toCsv } from "./csv.js";

test("escapes commas, quotes and newlines per RFC 4180", () => {
  assert.equal(escapeCsvCell("plain"), "plain");
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(escapeCsvCell(null), "");
});

test("neutralizes spreadsheet formula injection", () => {
  assert.equal(escapeCsvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(escapeCsvCell("+1"), "'+1");
  assert.equal(escapeCsvCell("-1"), "'-1");
  assert.equal(escapeCsvCell("@cmd"), "'@cmd");
  assert.equal(escapeCsvCell("=1,2"), "\"'=1,2\"");
});

test("joins rows with CRLF", () => {
  assert.equal(toCsv([["a", "b"], [1, null]]), "a,b\r\n1,");
});
