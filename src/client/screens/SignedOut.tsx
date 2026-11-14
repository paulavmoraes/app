import { Link } from "react-router";

export function SignedOutScreen() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Chores</h1>
      <p className="text-slate-600">You're not signed in on this device.</p>
      <ul className="list-disc space-y-2 pl-5 text-slate-700">
        <li>New here? Ask a flatmate for an invite link.</li>
        <li>
          Already a member (for example, you just installed the app on your iPhone)? Get a code from Settings on your other device and{" "}
          <Link to="/pair" className="text-teal-700 underline">
            enter a pairing code
          </Link>
          .
        </li>
      </ul>
    </div>
  );
}
