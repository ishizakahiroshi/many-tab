import test from "node:test";
import assert from "node:assert/strict";
import { buildPageCookieString, urlMatchesDomain } from "../lib/cookies.js";

test("buildPageCookieString excludes httpOnly cookies", () => {
  const out = buildPageCookieString([
    { name: "a", value: "1", httpOnly: true },
    { name: "b", value: "2", httpOnly: false },
    { name: "c", value: "3" },
  ]);
  assert.equal(out, "b=2; c=3");
});

test("buildPageCookieString handles empty input", () => {
  assert.equal(buildPageCookieString([]), "");
  assert.equal(buildPageCookieString(undefined), "");
});

test("urlMatchesDomain accepts the domain and its subdomains", () => {
  assert.equal(urlMatchesDomain("https://x.com/home", "x.com"), true);
  assert.equal(urlMatchesDomain("https://www.x.com/", "x.com"), true);
  assert.equal(urlMatchesDomain("https://x.com/", ".x.com"), true);
});

test("urlMatchesDomain rejects other hosts and invalid input", () => {
  assert.equal(urlMatchesDomain("https://notx.com/", "x.com"), false);
  assert.equal(urlMatchesDomain("https://x.com.example.org/", "x.com"), false);
  assert.equal(urlMatchesDomain("not a url", "x.com"), false);
  assert.equal(urlMatchesDomain(undefined, "x.com"), false);
  assert.equal(urlMatchesDomain("https://x.com/", ""), false);
});
