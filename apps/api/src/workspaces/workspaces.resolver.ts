import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { UnauthorizedException } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service";
import { Workspace, WorkspaceMembership } from "./workspace.types";

@Resolver(() => Workspace)
export class WorkspacesResolver {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Query(() => [Workspace])
  async workspacesForCurrentUser(@Context("req") req: { headers: Record<string, string | undefined> }): Promise<Workspace[]> {
    const userId = currentUserId(req);
    await this.workspaces.ensureWorkspaceForUser(userId);
    return this.workspaces.listForUser(userId);
  }

  @Query(() => [WorkspaceMembership])
  async workspaceMembers(
    @Args("workspaceId", { type: () => String }) workspaceId: string,
    @Context("req") req: { headers: Record<string, string | undefined> }
  ): Promise<WorkspaceMembership[]> {
    await this.workspaces.assertMember(workspaceId, currentUserId(req));
    return this.workspaces.listMemberships(workspaceId);
  }

  @Mutation(() => Workspace)
  createWorkspace(
    @Args("name", { type: () => String }) name: string,
    @Context("req") req: { headers: Record<string, string | undefined> }
  ): Promise<Workspace> {
    return this.workspaces.createWorkspace({ name, ownerId: currentUserId(req) });
  }
}

export function currentUserId(req: { headers: Record<string, string | undefined> }): string {
  const userId = req.headers["x-user-id"];
  if (!userId) {
    throw new UnauthorizedException("Missing authenticated user");
  }
  return userId;
}
