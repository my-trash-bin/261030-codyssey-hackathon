package domain
import "testing"
func TestStrict(t *testing.T){type V struct{Value string `json:"value"`};for _,s:=range []string{`{"value":"a","value":"b"}`,`{"Value":"a"}`,`{"value":1}`,`{"value":"a","extra":2}`,`{"value":"a"}{}`}{var v V;if Strict([]byte(s),&v)==nil{t.Errorf("accepted %s",s)}};var v V;if e:=Strict([]byte(`{"value":"한글"}`),&v);e!=nil{t.Fatal(e)}}
func TestEvidenceBytes(t *testing.T){s:=Source{ID:"s",Raw:[]byte("한글\r\nnext"),Included:true};s.SHA=Hash(s.Raw);ev:=EvidenceFor(s);task:=Task{Sources:[]Source{s},Evidence:ev};if e:=ValidateEvidence(task,[]string{ev[0].ID});e!=nil{t.Fatal(e)};task.Sources[0].Raw[0]='x';if ValidateEvidence(task,[]string{ev[0].ID})==nil{t.Fatal("changed bytes")}}
