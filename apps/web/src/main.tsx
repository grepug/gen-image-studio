import { ApolloClient, ApolloProvider, HttpLink, InMemoryCache } from "@apollo/client";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const httpLink = new HttpLink({
  uri: import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql",
  credentials: "include"
});

const client = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache()
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApolloProvider client={client}>
      <App />
    </ApolloProvider>
  </React.StrictMode>
);
