import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { WorkspacesService } from "./workspaces.service";
import { Workspace, WorkspaceMembership } from "./workspace.types";

const demoUserId = "00000000-0000-4000-8000-000000000001";

@Resolver(() => Workspace)
export class WorkspacesResolver {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Query(() => [Workspace])
  workspacesForCurrentUser(): Workspace[] {
    this.workspaces.ensureWorkspaceForUser(demoUserId);
    return this.workspaces.listForUser(demoUserId);
  }

  @Query(() => [WorkspaceMembership])
  workspaceMembers(@Args("workspaceId", { type: () => String }) workspaceId: string): WorkspaceMembership[] {
    return this.workspaces.listMemberships(workspaceId);
  }

  @Mutation(() => Workspace)
  createWorkspace(@Args("name", { type: () => String }) name: string): Workspace {
    return this.workspaces.createWorkspace({ name, ownerId: demoUserId });
  }
}
