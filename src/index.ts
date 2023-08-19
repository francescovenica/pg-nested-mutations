import { PgCodec } from "postgraphile/@dataplan/pg";
import { ObjectStep } from "postgraphile/grafast";

// Extend the global GraphileBuild.Build type to add our 'flibble' attribute:
declare global {
  namespace GraphileBuild {
    interface Build {
      nestedCodecs: {
        name: string;
        attribute: string;
        inputTypeName: string | null;
        direction: "forward" | "bakwards";
        localCodec: PgCodec;
        remoteCodec: PgCodec;
      }[];
      registeredField: string[];
      extendedField: string[];
    }
  }
}

let print = true;

export const NestedPlugin: GraphileConfig.Plugin = {
  name: "PgNestedMutationsPlugin",
  version: "0.0.0",
  schema: {
    hooks: {
      build(build) {
        build.nestedCodecs = [];
        build.registeredField = [];
        build.extendedField = [];
        return build;
      },
      init(_, build) {
        const {
          graphql,
          getGraphQLTypeNameByPgCodec,
          nestedCodecs,
          inflection,
        } = build;
        const {
          GraphQLInputObjectType,
          GraphQLBoolean,
          GraphQLString,
          GraphQLList,
        } = graphql;

        const { pgRelations } = build.input.pgRegistry;

        Object.values(pgRelations).forEach((tablesRelations) => {
          Object.values(tablesRelations).forEach((relation) => {
            let typeName: string;

            const inputTypeName = getGraphQLTypeNameByPgCodec(
              relation.remoteResource.codec,
              "input"
            );

            const localAttribute = inflection.upperCamelCase(
              relation.localAttributes[0]
            );

            if (relation.isReferencee) {
              typeName = `${inflection.upperCamelCase(
                relation.remoteResource.codec.name
              )}${inflection.upperCamelCase(
                relation.localCodec.name
              )}${localAttribute}FkeyInverseInput`;

              nestedCodecs.push({
                name: typeName,
                direction: "bakwards",
                localCodec: relation.localCodec,
                remoteCodec: relation.remoteResource.codec,
                attribute: relation.localAttributes[0],
                inputTypeName,
              });
            } else {
              typeName = `${inflection.upperCamelCase(
                relation.remoteResource.codec.name
              )}${inflection.upperCamelCase(
                relation.localCodec.name
              )}${localAttribute}FkeyInput`;

              nestedCodecs.push({
                name: typeName,
                direction: "forward",
                localCodec: relation.localCodec,
                remoteCodec: relation.remoteResource.codec,
                attribute: relation.localAttributes[0],
                inputTypeName,
              });
            }

            const newCodec = relation.localCodec;
            if (newCodec.attributes) {
              newCodec.attributes[relation.localAttributes[0]].notNull = false;
            }

            const localInputTypeName = getGraphQLTypeNameByPgCodec(
              newCodec,
              "input"
            );

            build.registerInputObjectType(
              typeName,
              { isInputType: true },
              () => ({
                type: GraphQLInputObjectType,
                name: typeName,
                description: typeName,
                fields: {
                  ...(localInputTypeName && {
                    create: {
                      type: new GraphQLList(
                        build.getInputTypeByName(localInputTypeName)
                      ),
                      description: "description",
                    },
                  }),
                  update: {
                    type: GraphQLString,
                    description: "description",
                  },
                  deleteOthers: {
                    type: GraphQLBoolean,
                    description: "description",
                  },
                },
                extensions: {
                  grafast: {
                    inputPlan($fieldArgs) {
                      console.log("args", $fieldArgs.getRaw());
                      return Object.create(null);
                    },
                  },
                },
              }),
              typeName
            );
          });
        });

        return _;
      },
      GraphQLInputObjectType_fields(fields, build, context) {
        const { scope, fieldWithHooks, Self } = context;

        if (!scope.isPgRowType || !scope.isInputType) return fields;

        const codecs = build.nestedCodecs.filter(
          ({ localCodec, remoteCodec }) => {
            return (
              context.Self.name ===
                build.getGraphQLTypeNameByPgCodec(localCodec, "input") ||
              context.Self.name ===
                build.getGraphQLTypeNameByPgCodec(remoteCodec, "input")
            );
          }
        );

        codecs.forEach((codec) => {
          if (codec?.inputTypeName === Self.name) {
            const fieldName =
              codec.direction === "bakwards"
                ? codec.localCodec.name
                : build.inflection.pluralize(codec.localCodec.name);

            try {
              build.extend(
                fields,
                {
                  [fieldName]: fieldWithHooks(
                    { fieldName: fieldName },
                    {
                      type: build.getInputTypeByName(codec.name),
                    }
                  ),
                },
                fieldName
              );
            } catch (error) {
              // console.log("Error", error);
            }
          }
        });

        return fields;
      },
      // GraphQLInputObjectType_fields_field(field, build, context) {
      //   if (context.scope.fieldName === "companyPageI18NS") {
      //     field.extensions = {
      //       grafast: {
      //         applyPlan: ($parentPlan, $fieldArgs) => {
      //           // console.log("parentPlan", $parentPlan);
      //           console.log("fieldPlan", $fieldArgs.get());
      //         },
      //       },
      //     };
      //   }

      //   return field;
      // },
    },
  },
};
