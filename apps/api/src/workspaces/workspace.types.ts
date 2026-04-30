import { Field, ObjectType, registerEnumType } from "@nestjs/graphql";

type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export enum WorkspaceRoleGql {
  owner = "owner",
  admin = "admin",
  member = "member",
  viewer = "viewer"
}

registerEnumType(WorkspaceRoleGql, { name: "WorkspaceRole" });

@ObjectType()
export class Workspace {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  createdAt: string;
}

@ObjectType()
export class WorkspaceMembership {
  @Field()
  id: string;

  @Field()
  workspaceId: string;

  @Field()
  userId: string;

  @Field(() => WorkspaceRoleGql)
  role: WorkspaceRole;
}
