import { gql } from "@apollo/client";

export const CURRENT_USER_QUERY = gql`
  query CurrentUser {
    currentUser {
      id
      displayName
    }
  }
`;

export const WORKSPACES_QUERY = gql`
  query Workspaces {
    workspacesForCurrentUser {
      id
      name
      slug
      createdAt
    }
  }
`;

export const WORKSPACE_MEMBERS_QUERY = gql`
  query WorkspaceMembers($workspaceId: String!) {
    workspaceMembers(workspaceId: $workspaceId) {
      id
      workspaceId
      userId
      displayName
      email
      role
    }
  }
`;

export const LOGOUT = gql`
  mutation Logout {
    logout
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

export const START_PASSKEY_REGISTRATION = gql`
  mutation StartPasskeyRegistration {
    startPasskeyRegistration {
      challengeId
      optionsJson
    }
  }
`;

export const FINISH_PASSKEY_REGISTRATION = gql`
  mutation FinishPasskeyRegistration($challengeId: String!, $responseJson: String!) {
    finishPasskeyRegistration(challengeId: $challengeId, responseJson: $responseJson) {
      userId
      displayName
      email
    }
  }
`;

export const START_PASSKEY_AUTHENTICATION = gql`
  mutation StartPasskeyAuthentication {
    startPasskeyAuthentication {
      challengeId
      optionsJson
    }
  }
`;

export const FINISH_PASSKEY_AUTHENTICATION = gql`
  mutation FinishPasskeyAuthentication($challengeId: String!, $responseJson: String!) {
    finishPasskeyAuthentication(challengeId: $challengeId, responseJson: $responseJson) {
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

export const ADD_WORKSPACE_MEMBER = gql`
  mutation AddWorkspaceMember($input: AddWorkspaceMemberInput!) {
    addWorkspaceMember(input: $input) {
      id
      displayName
      email
      role
    }
  }
`;

export const UPDATE_WORKSPACE_MEMBER_ROLE = gql`
  mutation UpdateWorkspaceMemberRole($input: UpdateWorkspaceMemberRoleInput!) {
    updateWorkspaceMemberRole(input: $input) {
      id
      role
    }
  }
`;

export const REMOVE_WORKSPACE_MEMBER = gql`
  mutation RemoveWorkspaceMember($membershipId: String!) {
    removeWorkspaceMember(membershipId: $membershipId)
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
