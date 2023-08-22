import "postgraphile";
import { PgCodecRelation } from "postgraphile/@dataplan/pg";

declare global {
  namespace GraphileBuild {
    interface Build {
      nestedCodecs: {
        name: string;
        inputTypeName: string | null;
        direction: "forward" | "bakwards";
        relation: PgCodecRelation;
      }[];
      registeredField: string[];
      extendedField: string[];
    }
    interface Inflection {
      buildForwardTypeName(this: Inflection, relation: PgCodecRelation): string;
      buildBackwardTypeName(
        this: Inflection,
        relation: PgCodecRelation
      ): string;
    }
  }
}

export const NestedPlugin: GraphileConfig.Plugin = {
  name: "PgNestedMutationsPlugin",
  version: "0.0.0",
  inflection: {
    add: {
      buildForwardTypeName(_, { remoteResource, localCodec, localAttributes }) {
        const localAttribute = this.upperCamelCase(localAttributes[0]);
        return `${this.upperCamelCase(
          remoteResource.codec.name
        )}${this.upperCamelCase(localCodec.name)}${localAttribute}FkeyInput`;
      },
      buildBackwardTypeName(
        _,
        { remoteResource, localCodec, localAttributes }
      ) {
        const localAttribute = this.upperCamelCase(localAttributes[0]);
        return `${this.upperCamelCase(
          remoteResource.codec.name
        )}${this.upperCamelCase(
          localCodec.name
        )}${localAttribute}FkeyInverseInput`;
      },
    },
  },
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
            const typeName = relation.isReferencee
              ? inflection.buildBackwardTypeName(relation)
              : inflection.buildForwardTypeName(relation);

            const inputTypeName = getGraphQLTypeNameByPgCodec(
              relation.remoteResource.codec,
              "input"
            );

            nestedCodecs.push({
              direction: relation.isReferencee ? "bakwards" : "forward",
              name: typeName,
              inputTypeName,
              relation,
            });

            // TODO: improve creating a new type for this
            const newCodec = relation.localCodec;
            if (newCodec.attributes) {
              newCodec.attributes[relation.localAttributes[0]].notNull = false;
            }

            const newInputTypeName = getGraphQLTypeNameByPgCodec(
              newCodec,
              "input"
            );

            build.registerInputObjectType(
              typeName,
              { isMutationInput: true },
              () => ({
                type: GraphQLInputObjectType,
                name: typeName,
                description: typeName,
                fields: {
                  ...(newInputTypeName && {
                    create: {
                      type: new GraphQLList(
                        build.getInputTypeByName(newInputTypeName)
                      ),
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

        const codecs = build.nestedCodecs.filter(({ relation }) => {
          const { localCodec, remoteResource } = relation;
          return (
            context.Self.name ===
              build.getGraphQLTypeNameByPgCodec(localCodec, "input") ||
            context.Self.name ===
              build.getGraphQLTypeNameByPgCodec(remoteResource.codec, "input")
          );
        });

        codecs.forEach((codec) => {
          if (codec?.inputTypeName === Self.name) {
            const fieldName =
              codec.direction === "bakwards"
                ? codec.relation.localCodec.name
                : build.inflection.pluralize(codec.relation.localCodec.name);

            // TODO: find why without this throw a duplicate error
            try {
              build.extend(
                fields,
                {
                  [fieldName]: fieldWithHooks(
                    { fieldName: fieldName },
                    { type: build.getInputTypeByName(codec.name) }
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
    },
  },
};
