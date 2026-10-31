import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFormat, locationsOf, parseFeed, suggestFields, toQty, toStockRows } from "./parse";

test("CSV με ; και εισαγωγικά, ελληνικές επικεφαλίδες", () => {
  const csv = '﻿Κωδικός;EAN;Περιγραφή;Ποσότητα;Κατάστημα\nA1;5201234567890;"Ψυγείο; λευκό";3;01\nA2;5201234567891;Κουζίνα;0;02\n';
  const p = parseFeed(csv, "csv");
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0]["Περιγραφή"], "Ψυγείο; λευκό");
  const h = suggestFields(p.columns, p.rows);
  assert.deepEqual(h, { ean: "EAN", qty: "Ποσότητα", location: "Κατάστημα", title: "Περιγραφή", sku: "Κωδικός" });
  const s = toStockRows(p.rows, h);
  assert.deepEqual(s[0], { externalSku: "A1", ean: "5201234567890", title: "Ψυγείο; λευκό", locationRef: "01", qty: 3 });
  assert.deepEqual(locationsOf(s).map((l) => l.ref), ["01", "02"]);
});

test("XML: η μεγαλύτερη λίστα είναι τα προϊόντα, attributes και #text", () => {
  const xml = `<?xml version="1.0"?><shop><info><name>Κατάστημα</name></info><products>
    <product id="1"><sku>X1</sku><barcode>4006381333931</barcode><stock>5</stock><brand><![CDATA[Bosch]]></brand></product>
    <product id="2"><sku>X2</sku><barcode>4006381333932</barcode><stock>0</stock><brand>Miele</brand></product>
  </products></shop>`;
  assert.equal(detectFormat(xml), "xml");
  const p = parseFeed(xml, "xml");
  assert.equal(p.rows.length, 2);
  const h = suggestFields(p.columns, p.rows);
  assert.equal(h.sku, "sku"); assert.equal(h.ean, "barcode"); assert.equal(h.qty, "stock"); assert.equal(h.brand, "brand");
  const s = toStockRows(p.rows, h);
  assert.equal(s[1].qty, 0); assert.equal(s[0].locationRef, "default");
});

test("JSON με εμφωλευμένα αντικείμενα", () => {
  const json = JSON.stringify({ data: { items: [{ code: "J1", gtin: "12345678", qty: "2,0", wh: { code: "A" } }, { code: "J2", gtin: "12345679", qty: "in stock" }] } });
  const p = parseFeed(json, detectFormat(json));
  const h = suggestFields(p.columns, p.rows);
  assert.equal(h.ean, "gtin");
  const s = toStockRows(p.rows, h);
  assert.deepEqual(s.map((r) => r.qty), [2, 1]);
});

test("EAN αναγνωρίζεται από το περιεχόμενο όταν η στήλη έχει άσχετο όνομα", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ col1: `52000000000${10 + i}`, sku: `S${i}`, qty: "1" }));
  assert.equal(suggestFields(["col1", "sku", "qty"], rows).ean, "col1");
});

test("toQty", () => {
  assert.equal(toQty("12"), 12); assert.equal(toQty("1,5"), 1.5); assert.equal(toQty("Ναι"), 1); assert.equal(toQty("out of stock"), 0);
  assert.equal(toQty(""), null); assert.equal(toQty("πολλά"), null);
});
