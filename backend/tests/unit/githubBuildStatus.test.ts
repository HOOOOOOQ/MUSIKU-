import {githubBuildStatus} from '../../src/services/githubBuildStatus';
test('GitHub status maps only public safe fields and fixed main workflow URL',async()=>{
 const fetcher=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({workflow_runs:[{id:123,status:'completed',conclusion:'success',html_url:'https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/123',updated_at:'2026-11-24',secret:'never-return'}]})} as Response);
 const result=await githubBuildStatus();expect(result.conclusion).toBe('success');expect(result.secret).toBeUndefined();expect(fetcher.mock.calls[0][0]).toContain('branch=main');fetcher.mockRestore();
});
