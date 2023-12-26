import test from "ava";
import { convertToNamedFunction } from "../src/nodes/run-javascript.js";

test("converts arrow function to named function", (t) => {
  // @ts-expect-error noImplicitAny
  const arrowFunc = ((x, y) => x + y).toString();
  const expected = "function sum(x, y) { return x + y; }";
  const result = convertToNamedFunction(arrowFunc, "sum");
  t.is(result, expected);
});

test("converts anonymous function to named function", (t) => {
  // @ts-expect-error noImplicitAny
  const anonFunc = function (x, y) {
    return x + y;
  }.toString();
  const expected =
    `function sum(x, y) {
        return x + y;
    }`;
  const result = convertToNamedFunction(anonFunc, "sum");
  t.is(result, expected);
});

test("keeps named function name if already named", (t) => {
  // @ts-expect-error noImplicitAny
  const namedFunc = function originalName(x, y) {
    return x + y;
  }.toString();
  const expected =
    `function sum(x, y) {
        return x + y;
    }`;
  const result = convertToNamedFunction(namedFunc, "sum");
  t.is(result, expected);
});

test("throws error for invalid function format", (t) => {
  const invalidFunc = "This is not a function";
  const error = t.throws(() => convertToNamedFunction(invalidFunc, "sum"));
  t.is(error?.message, "Invalid function format");
});

test("converts stringified arrow function to named function", (t) => {
  const arrowFunc = ((x: number, y: number) => x + y).toString();
  const expected = "function sum(x, y) { return x + y; }";
  const result = convertToNamedFunction(arrowFunc, "sum");
  t.is(result, expected);
});

test("converts stringified anonymous function to named function", (t) => {
  const anonFunc = function (x: number, y: number) {
    return x + y;
  }.toString();
  const expected =
    `function sum(x, y) {
        return x + y;
    }`;
  const result = convertToNamedFunction(anonFunc, "sum");
  t.is(result, expected);
});

test("keeps name of stringified named function", (t) => {
  const namedFunc = function originalName(x: number, y: number) {
    return x + y;
  }.toString();
  const expected =
    `function sum(x, y) {
        return x + y;
    }`;
  const result = convertToNamedFunction(namedFunc, "sum");
  t.is(result, expected);
});

test("handles no arguments", (t) => {
  const noArgFunc = (() => 42).toString();
  const expected = "function sum() { return 42; }";
  const result = convertToNamedFunction(noArgFunc, "sum");
  t.is(result, expected);
});

test("handles single argument", (t) => {
  // @ts-expect-error noImplicitAny
  const singleArgFunc = ((x) => x * 2).toString();
  const expected = "function sum(x) { return x * 2; }";
  const result = convertToNamedFunction(singleArgFunc, "sum");
  t.is(result, expected);
});

test("handles multiple arguments", (t) => {
  // @ts-expect-error noImplicitAny
  const multiArgFunc = ((x, y) => x + y).toString();
  const expected = "function sum(x, y) { return x + y; }";
  const result = convertToNamedFunction(multiArgFunc, "sum");
  t.is(result, expected);
});

test("handles default arguments", (t) => {
  // @ts-expect-error noImplicitAny
  const defaultArgFunc = ((x, y = 10) => x + y).toString();
  const expected = "function sum(x, y = 10) { return x + y; }";
  const result = convertToNamedFunction(defaultArgFunc, "sum");
  t.is(result, expected);
});

test("handles complex arguments", (t) => {
  // @ts-expect-error noImplicitAny
  const complexFuncString = ((x, { y, z } = { y: 1, z: 2 }) =>
    x + y + z).toString();
  const expected =
    "function sum(x, { y, z } = { y: 1, z: 2 }) { return x + y + z; }";
  const result = convertToNamedFunction(complexFuncString, "sum");
  t.is(result, expected);
});

test("handles multiline functions", (t) => {
  // @ts-expect-error noImplicitAny
  const multilineFunc = ((x) => {
    const y = 10;
    return x + y;
  }).toString();
  const expected =
    `function sum(x) {
        const y = 10;
        return x + y;
    }`;
  const result = convertToNamedFunction(multilineFunc, "sum");
  t.is(result, expected);
});

test("handles multiline functions with default arguments", (t) => {
  // @ts-expect-error noImplicitAny
  const multilineFunc = function (x) {
    const y = 10;
    return x + y;
  }.toString();
  const expected =
    `function sum(x) {
        const y = 10;
        return x + y;
    }`;
  const result = convertToNamedFunction(multilineFunc, "sum");
  t.is(result, expected);
});
