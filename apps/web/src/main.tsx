import { ApolloClient, ApolloLink, ApolloProvider, HttpLink, InMemoryCache } from "@apollo/client";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const httpLink = new HttpLink({
  uri: import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql",
  credentials: "include"
});

const authLink = new ApolloLink((operation, forward) => {
  const headers = (() => {
    const raw = localStorage.getItem("gen-image-studio:user");
    if (!raw) {
      return {};
    }
    const user = JSON.parse(raw) as { userId?: string };
    return user.userId ? { "x-user-id": user.userId } : {};
  })();
  operation.setContext({ headers });
  return forward(operation);
});

const client = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache()
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApolloProvider client={client}>
      <App />
    </ApolloProvider>
  </React.StrictMode>
);
