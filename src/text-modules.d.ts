// Text files imported as modules (wrangler bundles `.txt` files as strings): the faction list.
declare module "*.txt" {
  const text: string;
  export default text;
}
