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

export const LOGIN_WITH_PASSWORD = gql`
  mutation LoginWithPassword($email: String!, $password: String!) {
    loginWithPassword(email: $email, password: $password) {
      userId
      displayName
      email
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

export const CREATE_PROVIDER_PROFILE = gql`
  mutation CreateProviderProfile($input: ProviderProfileInput!) {
    createProviderProfile(input: $input) {
      id
      displayName
      providerType
      baseUrl
      defaultModel
      defaultImageModel
      capabilities
      hasApiKey
    }
  }
`;

export const UPLOAD_SKILL = gql`
  mutation UploadSkill($input: SkillUploadInput!) {
    uploadSkill(input: $input) {
      skill {
        id
        name
        slug
        status
      }
      version {
        id
        name
        description
        validationStatus
        validationErrors
      }
    }
  }
`;
