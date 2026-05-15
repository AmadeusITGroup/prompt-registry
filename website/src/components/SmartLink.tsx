import React from "react";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import { useLocation } from "@docusaurus/router";
import { resolveLink } from "./resolveLink";

type AnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement>;

export default function SmartLink({ href, children, ...props }: AnchorProps) {
  const location = useLocation();
  const baseUrl = useBaseUrl("/");
  const result = resolveLink(href, location.pathname, baseUrl);

  switch (result.type) {
    case "internal":
      return <Link to={result.to} {...props}>{children}</Link>;
    case "external":
      return <a href={result.href} {...props}>{children}</a>;
    default:
      return <a href={href} {...props}>{children}</a>;
  }
}