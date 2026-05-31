"use client";

/**
 * Renders compiled Velite MDX content.
 * Velite compiles MDX to a function-body string at build time;
 * we evaluate it here with react/jsx-runtime to get a React component.
 * Pre-rendered to HTML by Next.js at build time (SSG) — hydration only.
 */
import * as runtime from "react/jsx-runtime";
import { useMemo } from "react";
import { Callout } from "./callout";

interface MdxContentProps {
  code: string;
  components?: // eslint-disable-next-line @typescript-eslint/no-explicit-any
Record<string, React.ComponentType<any>>;
}

type MDXComponent = React.ComponentType<{
  components?: // eslint-disable-next-line @typescript-eslint/no-explicit-any
Record<string, React.ComponentType<any>>;
}>;

function useMDXComponent(code: string): MDXComponent {
  // eslint-disable-next-line no-new-func
  const fn = useMemo(() => new Function(code), [code]);
  return useMemo(
    () => (fn({ ...runtime }) as { default: MDXComponent }).default,
    [fn]
  );
}

const defaultComponents = {
  Callout,
};

export function MdxContent({ code, components = {} }: MdxContentProps) {
  const Component = useMDXComponent(code);
  return <Component components={{ ...defaultComponents, ...components }} />;
}
