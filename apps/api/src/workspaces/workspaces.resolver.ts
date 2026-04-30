import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { UnauthorizedException } from "@nestjs/common";
import { RequestWithHeaders, requireSessionUser } from "../auth/session";
import { WorkspacesService } from "./workspaces.service";
import { Workspace, WorkspaceMembership } from "./workspace.types";

@Resolver(() => Workspace)
export class WorkspacesResolver {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Query(() => [Workspace])
  async workspacesForCurrentUser(@Context("req") req: RequestWithHeaders): Promise<Workspace[]> {
    const userId = currentUserId(req);
    await this.workspaces.ensureWorkspaceForUser(userId);
    return this.workspaces.listForUser(userId);
  }

  @Query(() => [WorkspaceMembership])
  async workspaceMembers(
    @Args("workspaceId", { type: () => String }) workspaceId: string,
    @Context("req") req: RequestWithHeaders
  ): Promise<WorkspaceMembership[]> {
    await this.workspaces.assertMember(workspaceId, currentUserId(req));
    return this.workspaces.listMemberships(workspaceId);
  }

  @Mutation(() => Workspace)
  createWorkspace(
    @Args("name", { type: () => String }) name: string,
    @Context("req") req: RequestWithHeaders
  ): Promise<Workspace> {
    return this.workspaces.createWorkspace({ name, ownerId: currentUserId(req) });
  }
}

export function currentUserId(req: RequestWithHeaders): string {
  try {
    return requireSessionUser(req).userId;
  } catch {
    throw new UnauthorizedException("Missing authenticated user");
  }
}
