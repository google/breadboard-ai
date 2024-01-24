from main import AttrDict, Board, convert_from_json_to_pydantic
from javascript import require
import javascript
import json



class ImportedBoard(Board):
  def __init__(self, name, schema):
    self.type = name
    self.input_schema = schema["inputSchema"]
    self.output_schema = schema["outputSchema"]

def import_breadboard_js(package_name):
  
  if package_name == "@google-labs/llm-starter":
    kit_package = require("../../llm-starter/dist/src/index.js")
  elif package_name == "@google-labs/node-nursery-web":
    kit_package = require("../../node-nursery-web/dist/src/index.js")
  else:
    kit_package = require(package_name)
  a = kit_package()
  handlers = a.handlers

  output = AttrDict()
  for handler_name in handlers:
    if handlers[handler_name].describe is None:
      input_schema = {}
      output_schema = {}
    else:
      b = handlers[handler_name].describe()
      res = javascript.eval_js('''JSON.stringify(await b)''')
      schema = json.loads(res)
      input_schema = schema["inputSchema"]
      output_schema = schema["outputSchema"]
      input_schema, input_field = convert_from_json_to_pydantic("Input" + handler_name, input_schema)
      output_schema, output_field = convert_from_json_to_pydantic("Output" + handler_name, output_schema)

    class ImportedClass(Board[input_schema, output_schema]):
      type = handler_name
      title = f"Auto-imported {handler_name}"
      description = f"This board is auto-imported from {package_name}"
      version = "0.?"
      def describe(self, input):
        self.output = AttrDict(output_schema)
        return self.output
      def get_configuration(self):
        config = super().get_configuration()
        if "schema" in config:
          config.pop("schema")
        return config

    output[handler_name] = ImportedClass
  print(output)
  return output
