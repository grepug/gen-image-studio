import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { WorkspacesService } from "./workspaces.service";
import { Workspace, WorkspaceMembership } from "./workspace.types";

@Resolver(() => Workspace)
export class WorkspacesResolver {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Query(() => [Workspace])
  workspacesForCurrentUser(@Context("req") req: { headers: Record<string, string | undefined> }): Workspace[] {
    const userId = currentUserId(req);
    this.workspaces.ensureWorkspaceForUser(userId);
    return this.workspaces.listForUser(userId);
  }

  @Query(() => [WorkspaceMembership])
  workspaceMembers(
    @Args("workspaceId", { type: () => String }) workspaceId: string,
    @Context("req") req: { headers: Record<string, string | undefined> }
  ): WorkspaceMembership[] {
    this.workspaces.assertMember(workspaceId, currentUserId(req));
    return this.workspaces.listMemberships(workspaceId);
  }

  @Mutation(() => Workspace)
  createWorkspace(
    @Args("name", { type: () => String }) name: string,
    @Context("req") req: { headers: Record<string, string | undefined> }
  ): Workspace {
    return this.workspaces.createWorkspace({ name, ownerId: currentUserId(req) });
  }
}

export function currentUserId(req: { headers: Record<string, string | undefined> }): string {
  return req.headers["x-user-id"] ?? "00000000-0000-4000-8000-000000000001";
}
