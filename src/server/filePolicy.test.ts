import assert from "node:assert/strict";
import test from "node:test";
import { fileResponsePolicy } from "./filePolicy.js";

test("active document content is never served inline", () => {
  for (const fileName of ["payload.html", "diagram.svg", "data.xml", "page.xhtml"]) {
    const policy = fileResponsePolicy(fileName, false);
    assert.equal(policy.disposition, "attachment");
    assert.equal(policy.contentType, "application/octet-stream");
  }
});

test("known media and PDF files can be previewed inline", () => {
  assert.deepEqual(fileResponsePolicy("photo.webp", false), { contentType: "image/webp", disposition: "inline", sandbox: true });
  assert.deepEqual(fileResponsePolicy("report.pdf", false), { contentType: "application/pdf", disposition: "inline", sandbox: true });
});

test("download requests always force attachment disposition", () => {
  assert.equal(fileResponsePolicy("photo.png", true).disposition, "attachment");
});
