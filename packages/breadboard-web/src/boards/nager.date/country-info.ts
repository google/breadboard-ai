import { base } from "@google-labs/breadboard";
import { core } from "@google-labs/core-kit";
import { templates } from "@google-labs/template-kit";

const input = base.input({
  $id: "query",
  schema: {
    type: "object",
    properties: {
      countryCode: {
        title: "countryCode",
        type: "string",
        description: "The data for countryCode",
        enum: [
          "AD",
          "AL",
          "AM",
          "AR",
          "AT",
          "AU",
          "AX",
          "BA",
          "BB",
          "BE",
          "BG",
          "BJ",
          "BO",
          "BR",
          "BS",
          "BW",
          "BY",
          "BZ",
          "CA",
          "CH",
          "CL",
          "CN",
          "CO",
          "CR",
          "CU",
          "CY",
          "CZ",
          "DE",
          "DK",
          "DO",
          "EC",
          "EE",
          "EG",
          "ES",
          "FI",
          "FO",
          "FR",
          "GA",
          "GB",
          "GD",
          "GE",
          "GG",
          "GI",
          "GL",
          "GM",
          "GR",
          "GT",
          "GY",
          "HK",
          "HN",
          "HR",
          "HT",
          "HU",
          "ID",
          "IE",
          "IM",
          "IS",
          "IT",
          "JE",
          "JM",
          "JP",
          "KR",
          "KZ",
          "LI",
          "LS",
          "LT",
          "LU",
          "LV",
          "MA",
          "MC",
          "MD",
          "ME",
          "MG",
          "MK",
          "MN",
          "MS",
          "MT",
          "MX",
          "MZ",
          "NA",
          "NE",
          "NG",
          "NI",
          "NL",
          "NO",
          "NZ",
          "PA",
          "PE",
          "PG",
          "PL",
          "PR",
          "PT",
          "PY",
          "RO",
          "RS",
          "RU",
          "SE",
          "SG",
          "SI",
          "SJ",
          "SK",
          "SM",
          "SR",
          "SV",
          "TN",
          "TR",
          "UA",
          "US",
          "UY",
          "VA",
          "VE",
          "VN",
          "ZA",
          "ZW",
        ],
        default: "US",
      },
    },
    required: ["countryCode"],
  },
});

const urlTemplate = templates.urlTemplate({
  $id: "urlTemplate",
  template: "https://date.nager.at/api/v3/CountryInfo/{countryCode}",
  countryCode: input.countryCode,
});

const fetchUrl = core.fetch({
  $id: "fetch",
  method: "GET",
  url: urlTemplate.url,
});

const output = base.output({
  dates: fetchUrl.response,
});

export default await output.serialize({
  title: "Nager Date Country Info API",
  description: "Get the country info for the Nager Date API",
  version: "0.0.1",
});
