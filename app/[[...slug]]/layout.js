export async function generateMetadata({ params, searchParams }) {
  const slug = params?.slug || [];

  if (slug.length >= 2) {
    const [owner, repo] = slug;
    const task = searchParams?.task;
    const title = task
      ? `"${task}" — ${owner}/${repo} | mincontext`
      : `${owner}/${repo} | mincontext`;
    const description = task
      ? `Find the exact files needed to ${task} in ${owner}/${repo}`
      : `Find the exact files for any task in ${owner}/${repo}`;
    return {
      title,
      description,
      openGraph: { title, description, type: "website" },
      twitter: { card: "summary", title, description },
    };
  }

  return {
    title: "mincontext — find the exact files for any task",
    description: "Paste a GitHub repo, describe what you're building. Get back the exact files worth reading — nothing more.",
    openGraph: {
      title: "mincontext — find the exact files for any task",
      description: "Paste a GitHub repo, describe what you're building. Get back the exact files worth reading — nothing more.",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "mincontext — find the exact files for any task",
      description: "Paste a GitHub repo, describe what you're building. Get back the exact files worth reading — nothing more.",
    },
  };
}

export default function Layout({ children }) {
  return children;
}
