import yaml from "yaml";
import { readFile } from "fs/promises";
import { OpenAPI, OpenAPIV3, OpenAPIV3_1 } from "openapi-types";

export async function loadOpenAPI(
  url: string
): Promise<OpenAPIV3.Document | OpenAPIV3_1.Document> {
  let openAPIData = "";
  try {
    if (url.startsWith("file://")) {
      openAPIData = await readFile(url.replace("file://", ""), {
        encoding: "utf-8",
      });
    } else {
      openAPIData = await (await fetch(url)).text();
    }
  } catch (e) {
    throw new Error(`Unable to fetch OpenAPI spec from ${url}`);
  }

  try {
    return yaml.parse(openAPIData);
  } catch (yamlLoadError) {
    try {
      return JSON.parse(openAPIData);
    } catch (jsonLoadError) {
      throw new Error(
        `Unable to parse OpenAPI spec from ${url}. It's not a valid JSON or YAML file.`
      );
    }
  }
}
