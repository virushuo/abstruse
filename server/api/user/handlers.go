package user

import (
	"net/http"

	"github.com/bleenco/abstruse/pkg/security"
	"github.com/bleenco/abstruse/server/api"
	"github.com/bleenco/abstruse/server/db"
	"github.com/julienschmidt/httprouter"
)

// FetchPersonalInfo => GET /api/users/personal
func FetchPersonalInfo(res http.ResponseWriter, req *http.Request, _ httprouter.Params) {
	token := req.Header.Get("Authorization")
	userID, err := security.GetUserIDFromJWT(token)
	if err != nil {
		api.JSONResponse(res, http.StatusInternalServerError, api.ErrorResponse{Data: err.Error()})
		return
	}

	var user db.User
	_, err = user.Find(userID)
	if err != nil {
		api.JSONResponse(res, http.StatusInternalServerError, api.ErrorResponse{Data: err.Error()})
		return
	}

	api.JSONResponse(res, http.StatusOK, api.Response{Data: user})
}