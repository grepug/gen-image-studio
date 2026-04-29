import { gql } from "@apollo/client";

export const DASHBOARD_QUERY = gql`
  query Dashboard {
    currentUser {
      id
      displayName
    }
    workspacesForCurrentUser {
      id
      name
      slug
      createdAt
    }
  }
`;

export const PROVIDER_PROFILES_QUERY = gql`
  query ProviderProfiles($workspaceId: String!) {
    providerProfiles(workspaceId: $workspaceId) {
      id
      displayName
      providerType
      baseUrl
      defaultModel
      defaultImageModel
      capabilities
      hasApiKey
      verifiedAt
      createdAt
      updatedAt
    }
  }
`;

export const SKILLS_QUERY = gql`
  query Skills($workspaceId: String!) {
    skills(workspaceId: $workspaceId) {
      id
      name
      slug
      status
      latestVersionId
      createdAt
      updatedAt
    }
  }
`;

